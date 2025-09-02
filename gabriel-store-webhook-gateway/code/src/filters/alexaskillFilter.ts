export function alexaskillFilter(payload: any, config: any, _headers: any): boolean {
  const applicationId = payload?.session?.application?.applicationId;
  if (!applicationId) return false;
  return config?.applicationId === applicationId.toString();
}