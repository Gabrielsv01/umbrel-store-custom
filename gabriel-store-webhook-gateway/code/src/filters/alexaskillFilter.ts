export function alexaskillFilter(payload: any, config: any): boolean {
  const applicationId = payload?.session?.application?.applicationId;
  if (!applicationId) return false;
  return config?.applicationId === applicationId.toString();
}