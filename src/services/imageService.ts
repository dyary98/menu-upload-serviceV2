import path from "path";
import { promises as fs } from 'fs';
import fileType from 'file-type';
import sharp from "sharp";
import { uploadToS3, deleteFromS3 } from "../util/s3";
import { encode } from "blurhash";
import RouteError from "../constants/RouteError";
import HttpStatusCodes from "../constants/HttpStatusCodes";
import os from 'os';

/**
 * Helper function to generate a blurHash for an image.
 */
async function generateBlurHash(filePath: string): Promise<string> {
  try {
    const image = await sharp(filePath)
      .raw()
      .ensureAlpha()
      .resize(32, 32, { fit: "inside" })
      .toBuffer({ resolveWithObject: true });

    const { data, info } = image;
    return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 4);
  } catch (error) {
    throw new RouteError(HttpStatusCodes.INTERNAL_SERVER_ERROR, `Failed to generate blurHash for ${filePath}: ${error.message}`);
  }
}

/**
 * Compress images to medium and low quality.
 */
interface CompressionSettings {
  maxWidth: number;
  targetSize: number;
  initialQuality: number;
  minQuality: number;
}

/**
 * Compress images to high, medium, and low quality with target file sizes.
 */
async function compressImage(filePath: string, fileName: string): Promise<{ highPath: string, mediumPath: string, lowPath: string }> {
  try {
    const fileBuffer = await fs.readFile(filePath);
    const type = await fileType.fromBuffer(fileBuffer);
    
    if (!type || !isImageType(type.mime)) {
      throw new Error('Unsupported file type');
    }

    const fileDir = path.dirname(filePath);
    const ext = path.extname(fileName);

    const highPath = path.join(fileDir, `${fileName.replace(ext, '')}-high${ext}`);
    const mediumPath = path.join(fileDir, `${fileName.replace(ext, '')}-medium${ext}`);
    const lowPath = path.join(fileDir, `${fileName.replace(ext, '')}-low${ext}`);

    const sharpInstance = sharp(fileBuffer);
    const metadata = await sharpInstance.metadata();

    const compressionSettings: { [key: string]: CompressionSettings } = {
      high: { maxWidth: 2000, targetSize: 3 * 1024 * 1024, initialQuality: 100, minQuality: 90 },
      medium: { maxWidth: 1200, targetSize: 130 * 1024, initialQuality: 85, minQuality: 70 },
      low: { maxWidth: 800, targetSize: 20 * 1024, initialQuality: 70, minQuality: 10 }
    };

    // High quality (original size or max 2000px wide, below 3MB)
    if (metadata.width && metadata.width <= compressionSettings.high.maxWidth && fileBuffer.length <= compressionSettings.high.targetSize) {
      await fs.writeFile(highPath, fileBuffer); // Use original if it meets criteria
    } else {
      await compressToSize(sharpInstance, highPath, compressionSettings.high);
    }

    // Medium quality
    await compressToSize(sharpInstance, mediumPath, compressionSettings.medium);

    // Low quality
    await compressToSize(sharpInstance, lowPath, compressionSettings.low);

    return { highPath, mediumPath, lowPath };
  } catch (error) {
    throw new RouteError(HttpStatusCodes.INTERNAL_SERVER_ERROR, `Failed to compress image ${filePath}: ${error.message}`);
  }
}

/**
 * Check if the MIME type is an image type we support
 */
function isImageType(mimeType: string): boolean {
  const supportedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif'];
  return supportedImageTypes.includes(mimeType);
}


async function compressToSize(
  sharpInstance: sharp.Sharp,
  outputPath: string,
  settings: CompressionSettings
): Promise<void> {
  let quality = settings.initialQuality;
  let buffer: Buffer;

  do {
    buffer = await sharpInstance
      .clone()
      .resize({ width: settings.maxWidth, withoutEnlargement: true })
      .toFormat('jpeg', { quality })
      .toBuffer();

    if (buffer.length > settings.targetSize && quality > settings.minQuality) {
      quality -= 5;
    } else {
      break;
    }
  } while (true);

  await fs.writeFile(outputPath, buffer);
}

/**
 * Function to process and upload files to S3.
 */
const isWindows = os.platform() === 'win32';
const tempDir = path.join(os.tmpdir(), 'menu-upload-service-temp');

async function ensureTempDir() {
  try {
    await fs.mkdir(tempDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create temp directory:', error);
  }
}

async function moveFileToTemp(filePath: string) {
  if (!isWindows) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.warn(`Failed to delete file ${filePath}:`, error);
    }
    return;
  }

  try {
    const tempPath = path.join(tempDir, `${Date.now()}-${path.basename(filePath)}`);
    await fs.rename(filePath, tempPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`File ${filePath} already moved or doesn't exist.`);
    } else {
      console.warn(`Failed to move ${filePath} to temp directory:`, error);
    }
  }
}

async function cleanupTempFiles(maxAge = 24 * 60 * 60 * 1000) { // Default: 24 hours
  if (!isWindows) return;

  try {
    const files = await fs.readdir(tempDir);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stats = await fs.stat(filePath);
      if (now - stats.mtimeMs > maxAge) {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          console.warn(`Failed to delete old temp file ${filePath}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error during temp directory cleanup:', error);
  }
}

async function processAndUploadFiles(
  files: Express.Multer.File[],
  entityType: string
): Promise<{ urls: string[]; blurHash?: string; warnings: string[] }> {
  if (isWindows) {
    await ensureTempDir();
    await cleanupTempFiles(); // Clean up old temp files before processing new ones
  }

  const folderPath = getFolderPath(entityType);
  const urls: string[] = [];
  const warnings: string[] = [];
  let blurHash: string | undefined;

  for (const file of files) {
    let highPath: string | null = null;
    let mediumPath: string | null = null;
    let lowPath: string | null = null;

    try {
      const fileBuffer = await fs.readFile(file.path);
      const type = await fileType.fromBuffer(fileBuffer);
      
      if (!type) {
        throw new Error('Unable to determine file type');
      }

      let fileName = path.basename(file.originalname);
      const currentExt = path.extname(fileName);
      const detectedExt = `.${type.ext}`;

      if (!currentExt || currentExt.toLowerCase() !== detectedExt.toLowerCase()) {
        fileName = `${path.basename(fileName, currentExt)}${detectedExt}`;
      }
      fileName = fileName.toLowerCase();

      if (isImageType(type.mime) && ["category", "product", "banner"].includes(entityType)) {
        const compressedPaths = await compressImage(file.path, fileName);
        highPath = compressedPaths.highPath;
        mediumPath = compressedPaths.mediumPath;
        lowPath = compressedPaths.lowPath;

        const highUrl = await uploadToS3(highPath, `${folderPath}/H`, fileName);
        urls.push(highUrl);

        blurHash = await generateBlurHash(highPath);

        if (mediumPath) {
          const mediumUrl = await uploadToS3(mediumPath, `${folderPath}/M`, fileName);
          urls.push(mediumUrl);
        }

        if (lowPath) {
          const lowUrl = await uploadToS3(lowPath, `${folderPath}/L`, fileName);
          urls.push(lowUrl);  // Fixed: push the URL, not the file path
        }
      } else if (type.mime.startsWith("video/")) {
        const videoUrl = await uploadToS3(file.path, `${folderPath}/Video`, fileName);
        urls.push(videoUrl);
      } else {
        const fileUrl = await uploadToS3(file.path, folderPath, fileName);
        urls.push(fileUrl);
      }
    } catch (error) {
      console.error(`Error processing file ${file.originalname}:`, error);
      warnings.push(`Failed to process ${file.originalname}: ${error.message}`);
    } finally {
      // Move files to temp directory if on Windows, then attempt to delete
      const filesToProcess = [file.path, highPath, mediumPath, lowPath].filter(Boolean) as string[];
      for (const filePath of filesToProcess) {
        await moveFileToTemp(filePath);
      }
    }
  }

  return { urls, blurHash, warnings };
}

/**
 * Function to delete files from S3.
 */
async function deleteFiles(
  imagePrevName: string | undefined,
  videoPrevName: string | undefined,
  entityType: string
): Promise<void> {
  const folderPath = getFolderPath(entityType);

  // Define entity types that have multiple image sizes
  const multiSizeEntities = ['category', 'banner', 'product'];

  try {
    // Handle Image Deletion
    if (imagePrevName) {
      const fileExtension = path.extname(imagePrevName).toLowerCase();
      const validImageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.avif', '.bmp'];

      if (validImageExtensions.includes(fileExtension)) {
        if (multiSizeEntities.includes(entityType)) {
          // Entities with H, M, L folders
          const highPath = `${folderPath}/H/${imagePrevName}`;
          const mediumPath = `${folderPath}/M/${imagePrevName}`;
          const lowPath = `${folderPath}/L/${imagePrevName}`;

          await Promise.all([
            deleteFromS3(highPath).catch((error) => {
              throw new RouteError(
                HttpStatusCodes.INTERNAL_SERVER_ERROR,
                `Error deleting high-res image ${imagePrevName}: ${error.message}`
              );
            }),
            deleteFromS3(mediumPath).catch((error) => {
              throw new RouteError(
                HttpStatusCodes.INTERNAL_SERVER_ERROR,
                `Error deleting medium-res image ${imagePrevName}: ${error.message}`
              );
            }),
            deleteFromS3(lowPath).catch((error) => {
              throw new RouteError(
                HttpStatusCodes.INTERNAL_SERVER_ERROR,
                `Error deleting low-res image ${imagePrevName}: ${error.message}`
              );
            }),
          ]);
        } else {
          // Entities with a single image
          const imagePath = `${folderPath}/${imagePrevName}`;
          await deleteFromS3(imagePath).catch((error) => {
            throw new RouteError(
              HttpStatusCodes.INTERNAL_SERVER_ERROR,
              `Error deleting image ${imagePrevName}: ${error.message}`
            );
          });
        }
      }
    }

    // Handle Video Deletion
    if (videoPrevName) {
      const fileExtension = path.extname(videoPrevName).toLowerCase();
      const validVideoExtensions = ['.mp4', '.mkv', '.mov', '.avi'];

      if (validVideoExtensions.includes(fileExtension)) {
        const videoPath = `${folderPath}/Video/${videoPrevName}`;

        await deleteFromS3(videoPath).catch((error) => {
          throw new RouteError(
            HttpStatusCodes.INTERNAL_SERVER_ERROR,
            `Error deleting video file ${videoPrevName}: ${error.message}`
          );
        });
      }
    }
  } catch (error: any) {
    // If the error is already a RouteError, rethrow it
    if (error instanceof RouteError) {
      throw error;
    }
    // Otherwise, wrap it in a RouteError
    throw new RouteError(HttpStatusCodes.INTERNAL_SERVER_ERROR, `Error deleting files: ${error.message}`);
  }
}

/**
 * Function to get the folder path based on the entity type.
 */
function getFolderPath(entityType: string): string {
  switch (entityType) {
    case 'restaurant':
      return 'RPfs';
    case 'branch':
      return 'BPfs';
    case 'menu':
      return 'Mns';
    case 'category':
      return 'Cts';
    case 'product':
      return 'Pts';
    case 'banner':
      return 'Bns';
    case 'branding':
      return 'Bds';
    case 'addon':
      return 'Ads';
    default:
      throw new RouteError(HttpStatusCodes.BAD_REQUEST, 'Invalid entity type');
  }
}

export default {
  processAndUploadFiles,
  deleteFiles,
};