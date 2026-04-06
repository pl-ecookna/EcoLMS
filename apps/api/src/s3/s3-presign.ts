import { createHmac, createHash } from "node:crypto"

export interface S3PresignPartInput {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  bucket: string
  key: string
  uploadId: string
  partNumber: number
  expiresInSeconds?: number
  now?: Date
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

function encodePathSegment(value: string) {
  return encodeRfc3986(value).replace(/%2F/g, "/")
}

function canonicalQuery(params: Record<string, string>) {
  return Object.entries(params)
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey < rightKey) {
        return -1
      }
      if (leftKey > rightKey) {
        return 1
      }
      if (leftValue < rightValue) {
        return -1
      }
      if (leftValue > rightValue) {
        return 1
      }
      return 0
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&")
}

function hashSha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function hmacSha256(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest()
}

function toAmzDate(date: Date) {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  const hh = String(date.getUTCHours()).padStart(2, "0")
  const min = String(date.getUTCMinutes()).padStart(2, "0")
  const ss = String(date.getUTCSeconds()).padStart(2, "0")
  return {
    amzDate: `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`,
    dateStamp: `${yyyy}${mm}${dd}`,
  }
}

function buildSigningKey(secretAccessKey: string, dateStamp: string, region: string) {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, "s3")
  return hmacSha256(kService, "aws4_request")
}

export function createS3UploadPartPresignedUrl(input: S3PresignPartInput) {
  const expiresInSeconds = input.expiresInSeconds ?? 15 * 60
  const now = input.now ?? new Date()
  const { amzDate, dateStamp } = toAmzDate(now)

  const endpointUrl = new URL(input.endpoint)
  const canonicalUri = `/${encodePathSegment(input.bucket)}/${input.key
    .split("/")
    .map(encodePathSegment)
    .join("/")}`

  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`
  const authQueryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  }

  if (input.sessionToken) {
    authQueryParams["X-Amz-Security-Token"] = input.sessionToken
  }

  const canonicalQueryString = canonicalQuery({
    ...authQueryParams,
    partNumber: String(input.partNumber),
    uploadId: input.uploadId,
  })
  const canonicalHeaders = `host:${endpointUrl.host}\n`
  const signedHeaders = "host"
  const payloadHash = "UNSIGNED-PAYLOAD"

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n")

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hashSha256(canonicalRequest),
  ].join("\n")

  const signingKey = buildSigningKey(input.secretAccessKey, dateStamp, input.region)
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex")

  const operationQuery = canonicalQuery({
    uploadId: input.uploadId,
    partNumber: String(input.partNumber),
  })
  const authQuery = canonicalQuery(authQueryParams)
  const signedQuery = `${operationQuery}&${authQuery}&X-Amz-Signature=${signature}`
  return `${endpointUrl.origin}${canonicalUri}?${signedQuery}`
}
