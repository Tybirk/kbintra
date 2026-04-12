/**
 * Application configuration constants
 */

// File upload limits (must match backend settings)

export const MAX_UPLOAD_FILE_SIZE = 50 * 1024 * 1024 // 50MB per file

export const MAX_UPLOAD_FILE_SIZE_MB = 50

/**
 * Validate file size and return error message if too large
 */

export function validateFileSize(file: File): string | null {
  if (file.size > MAX_UPLOAD_FILE_SIZE) {
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1)

    return `File "${file.name}" is too large (${fileSizeMB}MB). Maximum allowed size is ${MAX_UPLOAD_FILE_SIZE_MB}MB.`
  }

  return null
}

/**
 * Filter files by size and return valid files plus any error messages
 */

export function filterFilesBySize(
  files: File[],
): {
  validFiles: File[]

  errors: string[]
} {
  const validFiles: File[] = []

  const errors: string[] = []

  for (const file of files) {
    const error = validateFileSize(file)

    if (error) {
      errors.push(error)
    } else {
      validFiles.push(file)
    }
  }

  return { validFiles, errors }
}
