import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// 从仓库根目录加载 .env（与提交的 .env.example 同级），不受启动 cwd 影响；
// dotenv 默认不覆盖已存在的环境变量，因此真实环境变量优先级更高。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env') });
