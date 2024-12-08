import './pre-start'; // Must be the first import
import logger from 'jet-logger';

import { Port } from '@src/constants/EnvVars';
import server from './server';


// **** Run **** //

const SERVER_START_MSG = ('Express server started on port: ' + 
  Port + ' in ' + process.env.NODE_ENV + ' mode');

server.listen(Port, () => {
  logger.info(SERVER_START_MSG);
});
