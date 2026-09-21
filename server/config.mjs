import {readFile, lstat} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {PlannerError} from './errors.mjs';

export const DEFAULT_MODEL = 'deepseek-flash';
export function hasConfiguredKey(value) {
  return typeof value === 'string' && value.trim().length >= 16 && !/your[_ -]?(?:(?:deepseek|openai)[_ -]?)?(?:api[_ -]?)?key|replace|placeholder|paste[_ -]|example|填入|密钥|^sk-?x+$|^sk-?\.{3}/i.test(value);
}
// Read only the dedicated server file, each time. Never inspect browser storage,
// Codex credentials, another dotfile, or execute a dotenv value.
export function createConfigLoader(file, env = process.env) {
  return async () => {
    let parsed = {};
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw new Error('invalid config');
      parsed = parseEnv(await readFile(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new PlannerError(503, 'CONFIG_ERROR', '本地模型配置暂时无法读取，请检查 server/.env.deepseek.local 文件。');
    }
    // Deliberately do not read or fall back to OPENAI_* credentials. A provider
    // switch must never send a previously configured provider's key elsewhere.
    const apiKey = String(env.DEEPSEEK_API_KEY ?? parsed.DEEPSEEK_API_KEY ?? '').trim();
    const candidate = String(env.DEEPSEEK_MODEL ?? parsed.DEEPSEEK_MODEL ?? DEFAULT_MODEL).trim();
    const model = candidate || DEFAULT_MODEL;
    if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) throw new PlannerError(503, 'CONFIG_ERROR', 'DEEPSEEK_MODEL 格式不正确，请填写 DeepSeek 模型名称。');
    return {apiKey, model, configured: hasConfiguredKey(apiKey)};
  };
}
