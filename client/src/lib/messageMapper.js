export const mapMessageDTO = (message) => ({
  id: message.id,
  text: message.content,
  userId: message.senderId,
  timestamp: message.createdAt,
});
