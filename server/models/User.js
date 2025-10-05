// Minimal factory for user objects
module.exports = function createUser({ id, name, email, passwordHash }) {
  return {
    id,
    name,
    email,
    passwordHash,
    streak: 0,
    lastCompletionDate: null
  };
};
