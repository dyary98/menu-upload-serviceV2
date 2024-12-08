/**
 * Setup express server.
 */

import morgan from 'morgan';
import helmet from 'helmet';
import express from 'express';
import 'express-async-errors';
import {NodeEnv} from '@src/constants/EnvVars';
import {NodeEnvs} from '@src/constants/Misc';
import uploadRoute from '@src/routes/UploadRoutes';
import genericError from '@src/middlewares/genericErrorMw';


// **** Variables **** //

const app = express();


// **** Setup **** //

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({extended: true}));

// Show routes called in console during development
if (NodeEnv === NodeEnvs.Dev.valueOf()) {
  app.use(morgan('dev'));
}

// Security
if (NodeEnv === NodeEnvs.Production.valueOf()) {
  app.use(helmet());
}

// Add generic error handler
app.use(genericError);

// Mount the upload route
app.use('', uploadRoute);

export default app;