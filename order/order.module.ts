import { forwardRef, Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { ProductModule } from '../product/product.module';
import { MerchantModule } from '../merchant/merchant.module';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '@snapi/bigcommerce';
import { Repository } from 'typeorm';

@Module({
  imports: [ MerchantModule, ProductModule, TypeOrmModule.forFeature([Order]), Repository],
  providers: [OrderService],
  controllers: [OrderController],
  exports: [OrderService]
})
export class OrderModule {}
