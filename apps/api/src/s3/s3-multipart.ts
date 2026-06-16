import { signS3Request } from "./s3-presign"

const DEFAULT_S3_ENDPOINT = "https://s3.ru1.storage.beget.cloud"
const DEFAULT_S3_BUCKET = "1bf1b61c108f-ecolms"
const DEFAULT_S3_REGION = "ru1"

function s3Config() {
  return {
    endpoint: process.env.S3_ENDPOINT ?? DEFAULT_S3_ENDPOINT,
    region: process.env.S3_REGION ?? DEFAULT_S3_REGION,
    bucket: process.env.S3_BUCKET ?? DEFAULT_S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    sessionToken: process.env.S3_SESSION_TOKEN,
  }
}

function extractXmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>\\s*([^<]*)\\s*</${tag}>`))
  return match?.[1] ?? null
}

export interface CreateMultipartUploadResult {
  uploadId: string
  bucket: string
  key: string
}

export async function createMultipartUpload(
  key: string,
  contentType?: string
): Promise<CreateMultipartUploadResult> {
  const cfg = s3Config()
  if (!cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error("S3 credentials are not configured")
  }

  const { url, headers } = signS3Request({
    method: "POST",
    endpoint: cfg.endpoint,
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    sessionToken: cfg.sessionToken,
    bucket: cfg.bucket,
    key,
    query: { uploads: "" },
  })

  if (contentType) {
    headers["Content-Type"] = contentType
  }

  const response = await fetch(url, { method: "POST", headers })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`S3 CreateMultipartUpload failed (${response.status}): ${body}`)
  }

  const xml = await response.text()
  const uploadId = extractXmlTag(xml, "UploadId")
  if (!uploadId) {
    throw new Error("S3 CreateMultipartUpload: no UploadId in response")
  }

  return { uploadId, bucket: cfg.bucket, key }
}

export interface CompletedPart {
  partNumber: number
  etag: string
}

export interface CompleteMultipartUploadResult {
  location: string
  bucket: string
  key: string
}

export async function completeMultipartUpload(
  key: string,
  s3UploadId: string,
  parts: CompletedPart[]
): Promise<CompleteMultipartUploadResult> {
  const cfg = s3Config()
  if (!cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error("S3 credentials are not configured")
  }

  const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber)
  const body =
    "<CompleteMultipartUpload>" +
    sortedParts
      .map(
        (p) =>
          `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`
      )
      .join("") +
    "</CompleteMultipartUpload>"

  const { url, headers } = signS3Request({
    method: "POST",
    endpoint: cfg.endpoint,
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    sessionToken: cfg.sessionToken,
    bucket: cfg.bucket,
    key,
    query: { uploadId: s3UploadId },
    body,
  })

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  })

  if (!response.ok) {
    const respBody = await response.text()
    throw new Error(`S3 CompleteMultipartUpload failed (${response.status}): ${respBody}`)
  }

  const xml = await response.text()
  return {
    location: extractXmlTag(xml, "Location") ?? "",
    bucket: extractXmlTag(xml, "Bucket") ?? cfg.bucket,
    key: extractXmlTag(xml, "Key") ?? key,
  }
}

export async function abortMultipartUpload(
  key: string,
  s3UploadId: string
): Promise<void> {
  const cfg = s3Config()
  if (!cfg.accessKeyId || !cfg.secretAccessKey) {
    return
  }

  const { url } = signS3Request({
    method: "DELETE",
    endpoint: cfg.endpoint,
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    sessionToken: cfg.sessionToken,
    bucket: cfg.bucket,
    key,
    query: { uploadId: s3UploadId },
  })

  try {
    await fetch(url, { method: "DELETE" })
  } catch {
    // best-effort cleanup
  }
}
