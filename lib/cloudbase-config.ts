export function getCloudBaseEnvId() {
  return process.env.CLOUDBASE_ENV_ID ?? process.env.TCB_ENV ?? "";
}

export function getCloudBaseSecretId() {
  return process.env.CLOUDBASE_SECRET_ID ?? process.env.TENCENTCLOUD_SECRETID ?? "";
}

export function getCloudBaseSecretKey() {
  return process.env.CLOUDBASE_SECRET_KEY ?? process.env.TENCENTCLOUD_SECRETKEY ?? "";
}

export function getCloudBaseSessionToken() {
  return process.env.CLOUDBASE_SESSION_TOKEN ?? process.env.TENCENTCLOUD_SESSIONTOKEN ?? "";
}

export function isCloudBaseConfigured() {
  return Boolean(getCloudBaseEnvId());
}
