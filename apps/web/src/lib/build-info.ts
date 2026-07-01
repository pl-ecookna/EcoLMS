const buildId = process.env.NEXT_PUBLIC_APP_BUILD_ID?.trim()

export const APP_BUILD_ID = buildId && buildId.length > 0 ? buildId : "dev"
