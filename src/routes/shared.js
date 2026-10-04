import { all } from '../db.js';

export const postAttachments = (postId) =>
  all('SELECT id, kind, url, original_name, mime, size_bytes FROM attachments WHERE post_id = ? ORDER BY id', postId);

/**
 * Comentários de um comunicado em árvore (raiz -> respostas).
 * Alunos não veem comentários ocultos; a equipe vê tudo exceto excluídos (a não ser que peça).
 */
export function commentTree(postId, { staff = false, viewerId = null } = {}) {
  const statuses = staff ? ['visible', 'hidden'] : ['visible'];
  const rows = all(
    `SELECT c.id, c.parent_id, c.body, c.is_question, c.status, c.created_at, c.user_id,
            u.name AS author_name, u.role AS author_role
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ? AND c.status IN (${statuses.map(() => '?').join(',')})
      ORDER BY c.created_at`,
    postId, ...statuses,
  );
  const byId = new Map(rows.map((c) => [c.id, { ...c, mine: c.user_id === viewerId, replies: [] }]));
  const roots = [];
  for (const c of byId.values()) {
    const parent = c.parent_id && byId.get(c.parent_id);
    (parent ? parent.replies : roots).push(c);
  }
  return roots;
}
