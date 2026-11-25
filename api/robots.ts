import type { ServerReq, ServerRes } from '../server/chatEngine';
import { handleRobotsRequest } from '../server/chatEngine';

export default function handler(req: ServerReq, res: ServerRes): void {
  handleRobotsRequest(req, res);
}
