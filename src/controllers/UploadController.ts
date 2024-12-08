import { Request, Response, NextFunction } from "express";
import HttpStatusCodes from "../constants/HttpStatusCodes";
import RouteError from "../constants/RouteError";
import imageService from "../services/imageService";
import logger from "jet-logger";
import axios from "axios";
import { MainServerUrl, MainServerJwt } from "@src/constants/EnvVars";

class UploadController {
  public static async uploadFiles(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { entityType, entityId, imagePrevName, videoPrevName } = req.body;
      const uploadedFiles = req.files as Express.Multer.File[];

      if (!uploadedFiles || !entityType || !entityId) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          "Files, entity type, or entity ID missing"
        );
      }

      // If prevName exists, delete the specified files from S3
      if (imagePrevName || videoPrevName) {
        await imageService.deleteFiles(imagePrevName, videoPrevName, entityType);
      } else {
        logger.warn("No previous files to delete");
      }

      // Process the files and upload them to S3
      const { urls, blurHash, warnings } = await imageService.processAndUploadFiles(
        uploadedFiles,
        entityType
      );

      // Log warnings if any
      if (warnings.length > 0) {
        logger.warn(`Warnings during file processing: ${warnings.join(', ')}`);
      }

      // Patch the entity with URLs and blurHash
      await UploadController.updateEntityOnMainServer(
        entityType,
        entityId,
        urls,
        blurHash
      );

      // Send a response with the URLs, blurHash, and warnings for confirmation
      res.status(HttpStatusCodes.OK).json({ urls, blurHash, warnings });
    } catch (error) {
      if (error instanceof RouteError) {
        res.status(error.status).json({ error: error.message });
      } else {
        logger.err(
          `[Error] ${error.message} - ${
            error.stack || "No stack trace available"
          }`,
          true
        );
        next(error);
      }
    }
  };

  public static async deleteFiles(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { entityType, imageName, videoName } = req.body;

      if (!entityType || !imageName) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          "Entity type or image name missing"
        );
      }

      // Delete the specified files from S3
      await imageService.deleteFiles(imageName, videoName, entityType);

      res.status(HttpStatusCodes.OK).json({ message: "Files deleted successfully" });
    } catch (error) {
      if (error instanceof RouteError) {
        res.status(error.status).json({ error: error.message });
      } else {
        logger.err(
          `[Error] ${error.message} - ${
            error.stack || "No stack trace available"
          }`,
          true
        );
        next(error);
      }
    }
  }

  // Update the entity in the main server with the URLs and blurHash
  private static async updateEntityOnMainServer(
    entityType: string,
    entityId: string,
    urls: string[],
    blurHash?: string
  ) {
    try {
      const patchUrl = UploadController.getPatchUrl(entityType, entityId);

      // Construct the payload conditionally based on entity type
      let data: any = {};
      switch (entityType) {
        case "product":
          data = {
            imageHigh: urls[0] || "",
            imageMedium: urls[1] || "",
            imageLow: urls[2] || "",
            video: urls[3] || "",
            blurHash: blurHash || "",
          };
          break;
        case "banner":
          data = {
            imageHigh: urls[0] || "",
            imageMedium: urls[1] || "",
            imageLow: urls[2] || "",
            blurHash: blurHash || "",
          };
          break;
        case "category":
          data = {
            imageHigh: urls[0] || "",
            imageMedium: urls[1] || "",
            imageLow: urls[2] || "",
            blurHash: blurHash || "",
          };
          break;
        case "branch":
          data = {
            image: urls[0] || "",
          };
          break;
        case "menu":
          data = {
            image: urls[0] || "",
          };
          break;
        case "restaurant":
          data = {
            logo: urls[0] || "",
          };
          break;
        default:
          throw new RouteError(
            HttpStatusCodes.BAD_REQUEST,
            "Invalid entity type for PATCH URL"
          );
      }

      // Send the PATCH request
      await axios.patch(patchUrl, data, {
        headers: {
          Authorization: `Bearer ${MainServerJwt}`, // Use the pre-generated JWT token
        },
      });

      logger.info(`Successfully updated ${entityType} with ID ${entityId}`);
    } catch (error) {
      logger.err(
        `Failed to update ${entityType} with ID ${entityId}: ${error.message}`,
        true
      );
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        `Failed to update ${entityType}`
      );
    }
  };

  // Determine the correct PATCH URL for the main server based on the entity type
  private static getPatchUrl(entityType: string, entityId: string): string {
    switch (entityType) {
      case "restaurant":
        return `${MainServerUrl}/restaurant/${entityId}/logo`;
      case "branch":
        return `${MainServerUrl}/branch/${entityId}/image`;
      case "menu":
        return `${MainServerUrl}/menu/${entityId}/image`;
      case "category":
        return `${MainServerUrl}/category/${entityId}/images`;
      case "product":
        return `${MainServerUrl}/product/${entityId}/images`;
      case "banner":
        return `${MainServerUrl}/banner/${entityId}/images`;
      default:
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          "Invalid entity type for PATCH URL"
        );
    }
  };
}

export default UploadController;
