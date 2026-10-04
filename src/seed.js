import { pathToFileURL } from 'node:url';
import { hashPassword } from './auth.js';
import { config } from './config.js';
import { migrate, one, run } from './db.js';

/** Cria o admin inicial (se não existir) e, opcionalmente, dados de demonstração. Idempotente. */
export async function seed() {
  const { adminUser, adminPassword, adminName, demo, demoStudentPassword } = config.seed;
  if (adminUser && adminPassword && !one('SELECT 1 FROM users WHERE username = ?', adminUser)) {
    run("INSERT INTO users (role, name, username, password_hash) VALUES ('admin', ?, ?, ?)", adminName, adminUser, await hashPassword(adminPassword));
    console.log(`[seed] usuário administrativo "${adminUser}" criado`);
  }
  if (!demo || one('SELECT 1 FROM series LIMIT 1')) return;

  const admin = one("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const prof = run("INSERT INTO users (role, name, username, password_hash) VALUES ('professor', 'Prof. Marina Lopes', 'marina', ?)",
    await hashPassword(demoStudentPassword || 'professor123'));
  const profId = Number(prof.lastInsertRowid);

  const serieIds = {};
  for (const [i, s] of ['1º Ano EM', '2º Ano EM', '3º Ano EM'].entries()) {
    serieIds[s] = Number(run('INSERT INTO series (name, sort_order) VALUES (?, ?)', s, i + 1).lastInsertRowid);
  }
  const turma = (serie, name) => Number(run("INSERT INTO turmas (name, serie_id, turno, year) VALUES (?, ?, 'Matutino', 2026)", name, serieIds[serie]).lastInsertRowid);
  const t1a = turma('1º Ano EM', 'A');
  const t2a = turma('2º Ano EM', 'A');
  const t3a = turma('3º Ano EM', 'A');
  turma('3º Ano EM', 'B');

  const pass = await hashPassword(demoStudentPassword || 'aluno123');
  const students = [
    ['Ana Beatriz Souza', '2026001', t3a], ['Bruno Henrique Lima', '2026002', t3a], ['Carla Mendes', '2026003', t2a],
    ['Diego Rocha', '2026004', t1a], ['Eduarda Alves', '2026005', t3a],
  ];
  const ids = [];
  for (const [name, mat, turmaId] of students) {
    const id = Number(run("INSERT INTO users (role, name, username, email, password_hash) VALUES ('aluno', ?, ?, ?, ?)",
      name, mat, `${mat}@aluno.tiraconnect.local`, pass).lastInsertRowid);
    run('INSERT INTO students (user_id, matricula, turma_id) VALUES (?, ?, ?)', id, mat, turmaId);
    ids.push(id);
  }

  const cat = (slug) => one('SELECT id FROM categories WHERE slug = ?', slug).id;
  const post = (title, body, slug, opts = {}) => Number(run(
    `INSERT INTO posts (title, body, category_id, urgent, pinned, status, publish_at, audience_type, audience_id, author_id)
     VALUES (?, ?, ?, ?, ?, 'published', datetime('now', ?), ?, ?, ?)`,
    title, body, cat(slug), opts.urgent ? 1 : 0, opts.pinned ? 1 : 0, opts.ago || '-1 hours',
    opts.audience_type || 'all', opts.audience_id || null, opts.author || admin.id,
  ).lastInsertRowid);

  post('Bem-vindos ao TiraConnect! 🎉',
    'Este é o novo canal oficial de comunicação da escola. Aqui você recebe provas, trabalhos, eventos e avisos em primeira mão.\n\nComente, tire dúvidas e marque os comunicados como lidos. A coordenação responde por aqui mesmo.',
    'avisos', { pinned: true, ago: '-3 days' });
  post('Semana de provas do 3º bimestre',
    'As provas acontecem de 13 a 17/10, sempre no 1º horário.\n\nSeg: Matemática · Ter: Português · Qua: Ciências da Natureza · Qui: Ciências Humanas · Sex: Inglês.\n\nTragam caneta azul ou preta e documento.',
    'provas', { urgent: true, ago: '-5 hours' });
  const feira = post('Feira de Ciências 2026 — inscrições abertas',
    'Grupos de até 4 alunos. Inscrições até 20/10 com o professor orientador. Tema livre, com prioridade para sustentabilidade e tecnologia.',
    'eventos', { ago: '-1 days', author: profId });
  post('Trabalho de Física — entrega dia 22/10',
    'Relatório do experimento de pêndulo simples. Formato PDF, até 5 páginas. Entrega pelo e-mail da professora.',
    'trabalhos', { ago: '-2 days', audience_type: 'turma', audience_id: t3a, author: profId });
  post('Feriado de 12 de outubro', 'Não haverá aula na segunda-feira, 12/10 (Nossa Senhora Aparecida). Retorno normal na terça-feira.', 'feriados', { ago: '-6 hours' });
  post('Reunião de pais e mestres', 'Sábado, 18/10, às 8h, no auditório. Pauta: resultados do bimestre e calendário de recuperação.', 'reunioes', { ago: '-2 hours' });

  const q = Number(run('INSERT INTO comments (post_id, user_id, body, is_question) VALUES (?, ?, ?, 1)',
    feira, ids[0], 'Pode ter integrante de outra turma no mesmo grupo?').lastInsertRowid);
  run('INSERT INTO comments (post_id, user_id, parent_id, body) VALUES (?, ?, ?, ?)', feira, profId, q,
    'Pode sim, Ana! Só precisa ser da mesma série. 😉');
  run('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)', feira, ids[1], 'Bora fazer sobre energia solar!');
  run("UPDATE posts SET notified = 1");
  console.log('[seed] dados de demonstração criados');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate();
  await seed();
}
