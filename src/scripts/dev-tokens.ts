import jwt from 'jsonwebtoken';
import 'dotenv/config';

const secret = process.env.JWT_SECRET || 'dev-secret';

[10, 24, 35].forEach((userId) => {
  const token = jwt.sign({ sub: userId, userId }, secret, { expiresIn: '7d' });
  console.log(`User ${userId} URL:\nhttp://localhost:5173/embed/?topicId=1&token=${token}\n`);
});