// Minimal factory for todo objects
module.exports = function createTodo({ id, userId, title, deadline, requiredMinutes }) {
  return {
    id,
    userId,
    title,
    deadline: deadline || null,               // ISO string or null
    requiredMinutes: Number(requiredMinutes) || 0,
    completed: false,
    createdAt: new Date().toISOString(),
    completedAt: null
  };
};
