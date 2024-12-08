import { UserAttributes } from '@src/models/User.model';
import { Request } from 'express';
import { Multer } from 'multer';

declare module 'express-serve-static-core' {
  interface Request {
    files?: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] };
    user?: Partial<UserAttributes> & { restaurantUser?: { restaurant_id: number } };
  }
}