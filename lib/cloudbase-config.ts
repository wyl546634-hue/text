export type CloudBaseCredentialMode = "auto" | "long-lived" | "temporary";

export type CloudBaseRuntimeDiagnostics = {
  mode: CloudBaseCredentialMode;
  envIdConfigured: boolean;
  regionConfigured: boolean;
  secretIdConfigured: boolean;
  secretKeyConfigured: boolean;
  sessionTokenConfigured: boolean;
  usesTemporaryCredentials: boolean;
  warnings: string[];
};

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

export function getCloudBaseRegion() {
  return process.env.CLOUDBASE_REGION ?? "";
}

export function getCloudBaseCredentialMode(): CloudBaseCredentialMode {
  const raw = (process.env.CLOUDBASE_CREDENTIAL_MODE ?? "auto").trim().toLowerCase();
  if (raw === "long-lived" || raw === "temporary") {
    return raw;
  }
  return "auto";
}

export function isCloudBaseConfigured() {
  return Boolean(getCloudBaseEnvId());
}

export function getCloudBaseRuntimeDiagnostics(): CloudBaseRuntimeDiagnostics {
  const mode = getCloudBaseCredentialMode();
  const envIdConfigured = Boolean(getCloudBaseEnvId());
  const regionConfigured = Boolean(getCloudBaseRegion());
  const secretIdConfigured = Boolean(getCloudBaseSecretId());
  const secretKeyConfigured = Boolean(getCloudBaseSecretKey());
  const sessionTokenConfigured = Boolean(getCloudBaseSessionToken());
  const usesTemporaryCredentials = mode === "temporary" || (mode === "auto" && sessionTokenConfigured);
  const warnings: string[] = [];

  if (!envIdConfigured) {
    warnings.push("未配置 CLOUDBASE_ENV_ID，后台无法连接 CloudBase。");
  }

  if (!regionConfigured) {
    warnings.push("未配置 CLOUDBASE_REGION，跨地域部署时可能出现访问失败。");
  }

  if (!secretIdConfigured || !secretKeyConfigured) {
    warnings.push("未配置长期 SecretId/SecretKey，当前环境无法作为长期稳定方案。");
  }

  if (mode === "temporary" && !sessionTokenConfigured) {
    warnings.push("当前设为 temporary 模式，但未配置 CLOUDBASE_SESSION_TOKEN。");
  }

  if (usesTemporaryCredentials) {
    warnings.push("当前仍在使用临时凭证，过期后后台会失效；长期稳定请改用长期 SecretId/SecretKey。");
  }

  if (mode === "long-lived" && sessionTokenConfigured) {
    warnings.push("已检测到 CLOUDBASE_SESSION_TOKEN，但 long-lived 模式会忽略它。");
  }

  return {
    mode,
    envIdConfigured,
    regionConfigured,
    secretIdConfigured,
    secretKeyConfigured,
    sessionTokenConfigured,
    usesTemporaryCredentials,
    warnings,
  };
}
