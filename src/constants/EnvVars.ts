/**
 * Environment variables declared here.
 */

/* eslint-disable node/no-process-env */

import dotenv from 'dotenv';

const envFile = `.env/${process.env.NODE_ENV || 'development'}.env`;
dotenv.config({ path: envFile });

export const NodeEnv = process.env.NODE_ENV || 'development';

export const Port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

export const AwsConfig = {
  AccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  SecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  Region: process.env.AWS_REGION || '',
  S3BucketName: process.env.S3_BUCKET_NAME || '',
};

export const MainServerUrl = process.env.MAIN_SERVER_URL || '';
export const MainServerJwt = process.env.MAIN_SERVER_JWT_SECRET || '';