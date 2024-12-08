import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
  DeleteObjectCommand,
  DeleteObjectCommandInput,
} from "@aws-sdk/client-s3";
import { AwsConfig } from "../constants/EnvVars";
import fs from "fs";

const s3 = new S3Client({
  region: AwsConfig.Region,
  credentials: {
    accessKeyId: AwsConfig.AccessKeyId,
    secretAccessKey: AwsConfig.SecretAccessKey,
  },
});

// const cloudFrontDomain = `${AwsConfig.CloudFrontDomain}`; //!! Uncomment this line if you are using CloudFront

async function uploadToS3(
  filePath: string,
  bucketFolder: string,
  fileName: string
): Promise<string> {
  const fileContent = fs.readFileSync(filePath);

  const params: PutObjectCommandInput = {
    Bucket: AwsConfig.S3BucketName,
    Key: `${bucketFolder}/${fileName}`,
    Body: fileContent,
  };

  const command = new PutObjectCommand(params);
  await s3.send(command);

  // Returning the file URL
  return `https://${AwsConfig.S3BucketName}.s3.${AwsConfig.Region}.amazonaws.com/${bucketFolder}/${fileName}`;
  // return `https://${cloudFrontDomain}/${bucketFolder}/${fileName}`; //!! Uncomment this line if you are using CloudFront
}

// Function to delete a file from S3
async function deleteFromS3(filePath: string): Promise<void> {
  try {
    const params: DeleteObjectCommandInput = {
      Bucket: AwsConfig.S3BucketName,
      Key: filePath,
    };

    const command = new DeleteObjectCommand(params);
    await s3.send(command);

  } catch (error) {
    console.error(`Error deleting file from S3: ${filePath}`, error);
    throw new Error(`Failed to delete ${filePath} from S3`);
  }
}

export { uploadToS3, deleteFromS3 };
