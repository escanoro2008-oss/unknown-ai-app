import type { ServerReq, ServerRes } from '../../server/chatEngine';
import { handleChatTitleRequest } from '../../server/chatEngine';

export default async function handler(req: ServerReq, res: ServerRes): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }
  await handleChatTitleRequest(req, res);
}
