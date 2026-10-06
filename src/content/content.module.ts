import { Module } from '@nestjs/common';
import {
  AboutPhotosController,
  CarouselController,
  CompanyController,
  CoverageZonesController,
  PlansController,
  SocialController,
} from './content.controller.js';
import { ContentService } from './content.service.js';
import { PublicSiteController } from './public-site.controller.js';

@Module({
  controllers: [
    CompanyController,
    PlansController,
    CarouselController,
    SocialController,
    AboutPhotosController,
    CoverageZonesController,
    PublicSiteController,
  ],
  providers: [ContentService],
})
export class ContentModule {}
