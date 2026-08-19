ALTER TABLE "messages" ADD COLUMN "media_base64" text;
ALTER TABLE "messages" ADD COLUMN "media_mime_type" varchar(100);