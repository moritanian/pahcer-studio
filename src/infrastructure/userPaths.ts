import * as os from 'os';
import * as path from 'path';

/**
 * pahcer-studio がユーザー単位で永続化する全データの保存先。
 * workspaces.json / instance.json / settings.json をここに集約する。
 *
 * cargo / rustup / nvm / deno などと同じく、ホーム直下のドット隠し
 * ディレクトリ方式で OS 横断的に単一の場所に置く。
 */
export function getUserDataDir(): string {
  return path.join(os.homedir(), '.pahcer-studio');
}
