import type { ServerReq, ServerRes } from '../server/chatEngine';
import { handleSitemapRequest } from '../server/chatEngine';

export default function handler(req: ServerReq, res: ServerRes): void {
  handleSitemapRequest(req, res);
}
