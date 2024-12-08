import { Request, Response, NextFunction } from 'express';
import HttpStatusCodes from '@src/constants/HttpStatusCodes';
import logger from 'jet-logger';
import RouteError from '@src/constants/RouteError';
import { NodeEnv } from '@src/constants/EnvVars';
import { NodeEnvs } from '@src/constants/Misc';

/**
 * Middleware to handle generic errors and format them for client responses.
 * @param error - The error object.
 * @param req - The Express request object.
 * @param res - The Express response object.
 * @param next - The Express next middleware function.
 */

interface CustomError extends Error {
  status?: number;
}

const genericError = (
  error: CustomError,
  req: Request, 
  res: Response, 
  next: NextFunction
) => {
  if (!res.headersSent) {
    if (error instanceof RouteError) {
      res.status(error.status).json({ error: error.message });
    } else {
      res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({
        status: HttpStatusCodes.INTERNAL_SERVER_ERROR,
        message: 'Internal Server Error',
      });
    }

    // Log the full error stack trace
    if (NodeEnv !== NodeEnvs.Test.valueOf()) {
      logger.err(`[Error] ${error.message} - ${error.stack || 'No stack trace available'}`, true);
    }
  }

  // Optional: Pass the error to the next middleware if needed
  next(error);
};

export default genericError;