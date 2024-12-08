import { Router } from 'express';
import UploadController from '../controllers/UploadController';
import upload from '../middlewares/uploadMw';

const router = Router();


router.post('/delete', UploadController.deleteFiles);
router.post('/upload', upload.array('files', 4), UploadController.uploadFiles);

export default router;
