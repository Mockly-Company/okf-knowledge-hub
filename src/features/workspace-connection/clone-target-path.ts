export function cloneTargetPath(parentDirectory: string, repositoryName: string): string {
  const separator = parentDirectory.includes("\\") && !parentDirectory.includes("/")
    ? "\\"
    : "/";
  return parentDirectory.endsWith("/") || parentDirectory.endsWith("\\")
    ? `${parentDirectory}${repositoryName}`
    : `${parentDirectory}${separator}${repositoryName}`;
}
