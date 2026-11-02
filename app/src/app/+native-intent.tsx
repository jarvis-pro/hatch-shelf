/**
 * 系统以 file:// URL 打开 App（AirDrop、「用书架打开」）时，不让路由去匹配这个 URL，
 * 统一回到书架；文件本身由 useIncomingFiles 导入。
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return path.startsWith('file://') ? '/' : path;
}
