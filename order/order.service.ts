import { ConnectorService } from '@kopamerchant/connector-sdk';
import { Body, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateOrderDto, Order } from '@snapi/bigcommerce';
import { CartRequestPayloadDto, CheckCartDto, CustomerDto, parseDescription, PlaceOrderDto } from '@snapi/common';
import axios, { AxiosInstance } from 'axios';
import { result, toInteger } from 'lodash';
import { DataSource, Repository } from 'typeorm';
import { MerchantService } from '../merchant/merchant.service';
import { ProductService } from '../product/product.service';

@Injectable()
export class OrderService {
  
    constructor(
        private readonly productService: ProductService,
        private readonly merchantService: MerchantService,
        @InjectRepository(Order)
        private readonly orderRepository:Repository <Order>,
        private dataSource: DataSource,
        private readonly connectorService: ConnectorService,
        ) {}
      
      async getCartById(id: string, merchantId: string) {
        const instance = await this.merchantService.getInstance(merchantId);
        const cart = await instance
          .get(`/v3/carts/${id}`)
          .then(async (res) => {
            return res.data.data;
          });
          return cart;
    
      }

      async OrderRemoveItem(itemId: number, merchantId: string, cartId: string,){
        const instance=await this.merchantService.getInstance(merchantId);
        const order=await instance.delete(`/v3/carts/${cartId}/items/${itemId}`).then(async (res) => {
                 return res.data.data;
               });
               console.log(order);
               return order;
       }	  

      async removeItemFromCart(payload: CartRequestPayloadDto ) {
        const instance =await this.merchantService.getInstance(payload.merchantId);
       let message = "";
       let success = true;
        let price =0;
       
        const prodId = parseInt(payload.productId);
        const varId = parseInt(payload.variantId);

       let cart = await this.getCartById(payload.orderId,payload.merchantId);
        //console.log("thisisthecart", cart.line_items.physical_items[0])
       if (cart){
        let itemDel;
        if(!cart.line_items.physical_items[1]){
          return {
            message: 'Your cart is empty now',
            variantId: '', 
            productId: '',
            success,
            orderId: '',
            item: {},
            action: payload.action,
            merchantId: payload.merchantId,
            shippingCost: 0,
            price: 0,
            quantity: 0
          }
        }
         if(payload.variantId)
          {
            itemDel = cart.line_items.physical_items.find((item) =>
             (item.product_id == prodId && item.variant_id == varId))
          }else{ 
            itemDel = cart.line_items.physical_items.find((item) =>
             item.product_id == prodId )
          }
          const product = await this.productService.getProductById(itemDel.product_id, payload.merchantId);
          console.log("inventarnivo1", product.inventory_level);

          //console.log("itemtodelete-1", cart.line_items.physical_items.find((item) =>
          //item.product_id == toInteger(payload.productId) ))
          cart = await this.OrderRemoveItem(itemDel.id, payload.merchantId, payload.orderId)
          //await this.updateProductStock(payload.merchantId, itemDel.product_id, product.inventory_level + toInteger(payload.quantity))
          const product2 = await this.productService.getProductById(product.id, payload.merchantId)
          console.log("inventarnivo2", product2.inventory_level);
          
          price = cart.cart_amount;
        }else{
        message = 'Failed to get cart';
        success = false;
       }
       let variantId = varId.toString();
       if(variantId === 'NaN'){
        variantId = '';
       }
       return {
        message,
        variantId, 
        productId: prodId.toString(),
        success,
        orderId: payload.orderId,
        item: {},
        action: payload.action,
        merchantId: payload.merchantId,
        shippingCost: 0,
        price,
        quantity: payload.quantity
      };
    }
          async makeCart(quantity: string, merchantId: string, productId: string, variantId:string ){
        const instance = await this.merchantService.getInstance(merchantId);
          //Telo zahteva za novu korpu, to je OBJEKAT:
        const bodyForCart = {
           //NIZ :STAVKE ARTIKLA KOJI SE DODAJE U KORPU 
            "line_items": [
                {
                    "quantity": quantity, 
                    "product_id": productId, 
                    "variant_id": variantId
                }
            ]
        }
        console.log("predKreiranjeKarta: ", bodyForCart);//Ovo se radi radi otklanjanja grešaka,štampanje na konzoli
        //метода шаље ХТТП ПОСТ захтев крајњој /v3/carts тачки користећи Акиос инстанцу добијену раније, прослеђујући објекат bodyForCart као тело захтева. 
       //metoda 'post()' vraća Promis koji se rešava odgovorom sajta bicomerca. Метод затим чека да се Промисе реши помоћу await кључне речи и користи then()метод
       // на решеном Промисе-у да издвоји data својство из објекта одговора. Ово 'data' својство садржи податке одговора које враћа sajt, што је у овом случају новокреирана колица.  
        const cart = await instance
        .post('/v3/carts', bodyForCart).then(
            async (res) => {
                return res.data;
            }
        )
        //console.log("krajMakeACart :", cart);
        return cart;
    }

    
    async getCreateCartPayloadVariants(payload: CartRequestPayloadDto){
        const merchantId = payload.merchantId;

        const supportedPaymentMethods = await this.merchantService.getPaymentMethods(merchantId);

        const store = await this.merchantService.getMerchant(merchantId);

        const company = {
          name: store.companyName,
          address: store.companyAddress,
          pib: store.companyPib,
          email: store.email,
          webShopUrl: store.webshopUrl,
          activityName: store.companyActivityName,
          activityCode: store.companyActivityCode,
          companyNumber: store.companyNumber,
          phoneNumber: store.phoneNumber,
        };

        const cartPayload = await this.getCartPayloadVariants(payload);
        
        return {
          ...cartPayload,
          bankMerchantId: store.bankMerchantId,
          company,
          supportedPaymentMethods,
        };
      }

   async getCartPayloadVariants(payload: CartRequestPayloadDto) {
    const product = await this.productService.getProductById(payload.productId, payload.merchantId);
    const variants = await this.productService.getProductByVariant(payload.productId, payload.merchantId);// VRAĆA  NIZ  VARIJANTI
    const variantOptions = await this.productService.getProductOptions(payload.productId, payload.merchantId);
    
    let success = true; 
    let item = {}; 
    let message = '';
    let orderId = '';
    let subtotal = 0;

    if (product) {
      let stock, price, id;

      const description = product.description//  on skida  tj. parsira html tagove i daje običan tekst bez tagova iz jason odgovora
        ? parseDescription(product.description)
        : 'No description available';

      if (product.inventory_level != 0) {
          stock = product.inventory_level;//
          price = product.price;
          id = product.id;
        

        let cart;
            
        const allVariants = variants.map(variant => {
          const variant_description = variant.option_values.map((option) => option.label).join(", ");
          const variant_options = variant.option_values.map((option) => {
            return {
              name: option.option_display_name, 
              value: option.label, 
              id: option.id.toString(), 
              option_id: option.option_id.toString()
            }
          })
          return {
            id: variant.id.toString(), 
            stock: variant.inventory_level, 
            price_gross: variant.calculated_price, 
            variant_description,
            variant_image: variant.image_url, 
            variant_options, 
          }
        })

        const selectedVariant = variants.find(variant => variant.id === +payload.variantId)//traži varijantu po određenom ID iz panela sa sajta sa Id iz paylouda tj. poziva klijenta
           
       const variant_options = selectedVariant.option_values.reduce((obj, option) => {
          const { option_display_name, label } = option;//destrukuiranje
          return { ...obj, [option_display_name]: label };
        }, {});
        // definisali smo objekat  šta je selektovana varijanta ,tj. povratna poruka u stvari on je formatiran
        const selected_variant = {
          id: selectedVariant.id.toString(), 
          stock: selectedVariant.inventory_level, 
          price_gross: selectedVariant.calculated_price, 
          variant_options
        }

        const variants_list = variantOptions.reduce((obj, attribute) => {
          const { display_name, option_values } = attribute;
          return {
            ...obj,
            [display_name]: option_values.map((option) => option.label).join(','),//  povratna informacija je    "variants_list":   Color:žuta,plava
          };
        }, {});
            // ako je create  onda formiramo korpu,ako je create onda se formira korpa i item ili produkt a ako ne ma create onda se samo dodaje item u staru korpu
            //rezultujući 'cart'(Када makeCart()се метода заврши) objekat se dodeljuje promenivoj 'cart'
        if (payload.action === 'create') {
          cart = await this.makeCart(
            payload.quantity, 
            payload.merchantId, 
            payload.productId, payload.variantId
          );
          orderId = cart.data.id;//poziva ID iz korpe i smešta  id od korpe u orderId
          subtotal = cart.data.cart_amount // ukupna cena od korpe
         // ovo još nije definisano
         //informacije o porudžbini radi daljeg praćenja
         //ovo ne treba orderInfo
         const orderInfo = {
            merchantId: payload.merchantId,
            orderId,//gore je definisan
            paymentStatus: 'reserved',//уплата за поруџбину резервисана, али још увек није забележена или обрађена.
            contactId: payload.contactId,//подешено на вредност својства contactIdиз payloadобјекта.
            shippingStatus: 'awaiting',//porudžbina čeka na isporuku
            cartReservationCounter: 0,
          };

          this.saveOrder(orderInfo);//stavljamo item u staru korpu
          //isti je poziv kao kada se pravi Cart samo što se umesto .Post  stavi se .Put
        } else {
          orderId = payload.orderId;//order je sada samo korpa,uzima se stari  Id
          cart = await this.addItemToCart(//oda dodaj item u korpu
            payload.merchantId,
            payload.productId,
            orderId,
            payload.quantity,
            payload.variantId
          );
          subtotal = cart.cart_amount;// i to je sada pošto smo dodali novi item je nova cena
        }

        if (cart) {//  ako postoji korpa// dodaje na displej novi item
          item = {
            productId: id.toString(),
            variantId: selectedVariant.id.toString(),
            name: product.name,
            description: description,
            stock,
            price,
            images: {
              thumb: selectedVariant.image_url,
              medium: selectedVariant.image_url,
              large: selectedVariant.image_url,
            },
            variants_list,
            variants: allVariants,
            selected_variant,
            type: "multi_variant"
          };
          /*
          await this.updateProductStock(
            payload.merchantId,
            sku,
            stockStatus.itemId,
            stockStatus.stockItemQt,
            -qt
          );*/
        } else {// ako nema korpe onda poruka
          message =
            payload.action === 'create'
              ? 'Failed to create order'
              : 'Failed to add product to order';
          success = false;// to ide na aplikaciju kao povratna poruka ikaže da je neuspešna
        }
      } else {
        message = 'Out of stock';//  to su povratne poruke koje definišu dali će se napraviti korpa ili ne
        success = false;// ako je true napraviće se korpa a ako je false onda neće da se napravi
      }
    } else {
      message = 'Failed to get product information';//nije uspeo da uzme produkt
      success = false;
    }
//OVO TREBA DA IDE KOPI
    return {
      action: payload.action,
      connectorId: payload.connectorId, 
      contactId: payload.contactId,
      message,
      success,
      orderId,
      quantity: 1,
      price: subtotal,
      merchantId: payload.merchantId,
      shippingCost: 0,
      productId: payload.productId,
      variantId: payload.variantId,
      item,
    };
  }
//Сврха функције је да врати објекат који се може користити као терет захтева за креирање нове колица.
    async getCreateCartPayload(payload: CartRequestPayloadDto) {
        const merchantId = payload.merchantId;
        const supportedPaymentMethods = await this.merchantService.getPaymentMethods(merchantId);

        const store = await this.merchantService.getMerchant(merchantId);

        const company = {
          name: store.companyName,
          address: store.companyAddress,
          pib: store.companyPib,
          email: store.email,
          webShopUrl: store.webshopUrl,
          activityName: store.companyActivityName,
          activityCode: store.companyActivityCode,
          companyNumber: store.companyNumber,
          phoneNumber: store.phoneNumber,
        };
        console.log("okoktest")
        const cartPayload = await this.getCartPayload(payload);
        console.log("prosla kreacija korpe", cartPayload);
        return {
          ...cartPayload,
          bankMerchantId: store.bankMerchantId,
          supportedPaymentMethods,
          company,
        };
      }

  async getCartPayload(payload: CartRequestPayloadDto) {//to je iz POC-a to je PAYLOAD IZ MOBILNE
    
    const product = await this.productService.getProductById(payload.productId, payload.merchantId);
    const instance = await this.merchantService.getInstance(payload.merchantId);
    const variants = await this.productService.getProductByVariant(product.id, payload.merchantId);

    const variant = variants.find(item => item.id === product.base_variant_id);

    const img = variant.image_url;
    let success = true;
    let item = {};
    let message = '';
    let orderId = '';
    let subtotal = 0;

    if (product) {
      let stock, price, id;// inventory_level je stock
      const description = product.description  
        ? parseDescription(product.description)
        : 'No description available';

      if (product.inventory_level != 0) {
          stock = product.inventory_level;
          price = product.calculated_price;
          id = product.id;

          console.log("pricehere",price);
        
        let cart;
        console.log("payloadaction", payload.action)
       
       
        if (payload.action === 'create') {
          cart = await this.makeCart(
            payload.quantity, 
            payload.merchantId, 
            payload.productId, payload.variantId
          );
          orderId = cart.data.id;
          subtotal = cart.data.cart_amount
          const orderInfo = {//ne koristi se  ovo
            merchantId: payload.merchantId,
            orderId,
            paymentStatus: 'reserved',
            contactId: payload.contactId,
            shippingStatus: 'awaiting',
            cartReservationCounter: 0,
          };

          this.saveOrder(orderInfo);
        } else{//to je druga akcija koja sledi ako nije prvo dodavanje drugo dodavanje ili treće i zove se add
          console.log("In the add!");
            orderId = payload.orderId;//oredrId je = cartId, tj.mi cartId peimenujemo u orderId
            cart = await this.addItemToCart(// dodajemo stvar u korpu
              payload.merchantId,//to je iz te metode
              payload.productId,
              orderId,
              payload.quantity,
              payload.variantId
            );

            console.log(cart);
            subtotal = cart.cart_amount;
        }
        const images = {
            thumb: img,
            medium: img, 
            large: img,
        }
        console.log ( "slika", images)
        if (cart) {
          item = {
            productId: id,
            variantId: "",
            name: product.name,
            description: description,
            stock,
            price,
            images,
            variants_list:{},
            variants:[],
            selected_variant:{},
            type:"basic"
          };
          console.log("wholeitem",item);
          /*
          await this.updateProductStock(
            payload.merchantId,
            sku,
            stockStatus.itemId,
            stockStatus.stockItemQt,
            -qt
          );*/
        } else {
          message =
            payload.action === 'create'
              ? 'Failed to create order'
              : 'Failed to add product to order';
          success = false;
        }
      } else {
        message = 'Out of stock';
        success = false;
      }
    } else {
      message = 'Failed to get product information';
      success = false;
    }

    return {
      action: payload.action,
      message,
      success,
      orderId,
      merchantId: payload.merchantId,
      shippingCost: 0,
      price: subtotal,
      item,
    };
    }
  saveOrder( createOrderDto: CreateOrderDto) {//polja iz baze su createOrderDto
    const order = this.orderRepository.create(createOrderDto)//kreiramo tabelu
    return this.orderRepository.save(order);//sada se ubacuje u order
  }

  async addItemToCart(merchantId:string, product_id: string, orderId: string, quantity: string, variant_id: string){
    const instance = await this.merchantService.getInstance(merchantId);
    let body;
    if(variant_id){
        body = {
          line_items: [//moramo prosleđujemo instanci
            {
                quantity, 
                product_id, 
                variant_id
            }
        ]
        }
    }else{
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      body = {
        line_items: [//ako nema varijante
          {
              quantity, 
              product_id, 
          }
      ]
      }
    }
    console.log(body);
    const data = await instance.post(`/v3/carts/${orderId}/items`, body)
      .then((res) => {
        //console.log("resdataforadd",res.data.data)
        return res.data.data;//prvi data je promenjiva koja uvek ide uz respons a druga je tu jer je imenovana u Jason podatku da se izbegne meta odgovor,prvi data se neviti to je ceo podatak u responsu 
      }).catch((error) => console.log(error));

      return data;
  }//response je samo 200OK, time ms i size kb  a response.data je ceo podatak iz Jasona

  async updateItemStock(payload: CartRequestPayloadDto) {
    const instance = await this.merchantService.getInstance(payload.merchantId);
    
    let message = '';
    let success = true;
    let price = 0;

    const prodId = parseInt(payload.productId);
    const varId = parseInt(payload.variantId);
    const quantity = toInteger(payload.quantity);

    let cart = await this.getCartById(payload.orderId, payload.merchantId);

    if(cart){
      let product;
      if(varId){
        product = await this.productService.getProductByVariantId(payload.productId, payload.variantId, payload.merchantId);
      }
      else
      {
        product = await this.productService.getProductById(payload.productId, payload.merchantId);
      }

      console.log(product.inventory_level);
      const cartProd = cart.line_items.physical_items.find((item) => item.product_id === prodId);
      let n = 0;
      if(+payload.quantity > cartProd.quantity){
        n = product.inventory_level - 1
      }
      else
        n = product.inventory_level + 1;
      if(n > 0){

        console.log(payload.quantity, quantity, n)
        const updatedItem = await this.updateItemOnCart(payload.merchantId, cartProd.id, payload.orderId, quantity, product.id);
        console.log("updatedcart", updatedItem);
        cart = await this.getCartById(payload.orderId, payload.merchantId);
       console.log(cart.line_items.physical_items);
       price = cart.cart_amount;
        //console.log(updatedItem);
         if(updatedItem){
        //   product = await this.updateProductStock(
        //     payload.merchantId, 
        //     prodId, 
        //     n
        //   )
        }else{
          message = 'Failed to update quantity in the cart';
          success = false;
        }
      
      }else {
        message = 'Out of stock';
        success = false;
      }
      
    console.log(product.inventory_level);
    }else {
      message = 'Failed to get order';
      success = false;
    }

    let variantId = varId.toString();
       if(variantId === 'NaN'){
        variantId = '';
       }

       
       cart = await this.getCartById(payload.orderId, payload.merchantId);
       console.log(cart.line_items.physical_items);
       price = cart.cart_amount;

    return {
      message,
      success,
      productId: prodId.toString(),
      variantId,
      orderId: payload.orderId,
      item: {},
      action: payload.action,
      merchantId: payload.merchantId,
      shippingCost: 0,
      price,
      quantity: payload.quantity
    };
  }
  // async updateProductStock(merchantId: string, prodId: number, inventory_level: number) {
  //   const instance = this.merchantService.getInstance(merchantId); 
  //   const body = {
  //     inventory_level
  //   }

  //   const updatedProductOnPanel = (await instance).put(`/v3/catalog/products/${prodId}`, body)
  //     .then((response) => {return response.data.data})//console.log(response))
  //     .catch((error) => console.log(error));

  //     return updatedProductOnPanel;
  // }

  async updateItemOnCart(merchantId: string, id: any, orderId: string, quantity: number, product_id: number) {
    const instance = this.merchantService.getInstance(merchantId); 
    const body = {
      line_item: {
        quantity, 
        product_id
      }
    }

    const response = (await instance).put(`/v3/carts/${orderId}/items/${id}`, body)
      .catch((error) => console.log(error));
      if (response) {
        return true;
      }
  
      return false;
  }

  async checkCart(payload: CheckCartDto) {
    const instance = await this.merchantService.getInstance(payload.merchantId);
    const cart = await this.getCartById(payload.orderId, payload.merchantId);
    const orderExists = cart ? ('true' as const) : ('false' as const);
  
    return {
      orderId: payload.orderId, 
      orderExists
    };
  }
// ovo je NOvo od 1.03.2023 dodavanje podataka o kupcu
  async addCustomerToCart(payload: CustomerDto) {
    const instance = this.merchantService.getInstance(payload.merchantId);
    let checkout = await this.addBillingAddress(payload, payload.merchantId);
    console.log("billinginfo", checkout);
    checkout = await this.addShippingAddress(payload, payload.merchantId);

    const shippingOptions = await this.shippingOptions(payload, payload.merchantId);
    const selectedOption = {
      "shipping_option_id" : shippingOptions[0].id
    }
    const consignmentId = checkout.consignments[0].id;
    checkout = await (await instance).put(`/v3/checkouts/${payload.orderId}/consignments/${consignmentId}`, selectedOption)
    .then( res => {
      return res.data.data;
      })

    if(checkout){
      return checkout;
    }
    else {
      return 'Failed to add address and email to cart';
    }
  }

  async addShippingAddress(payload: CustomerDto, merchantId: string){
    const instance = await this.merchantService.getInstance(merchantId);
    const { name, lastName, address, city, phone, postcode} = payload.customerAddress;

    const cart = await this.getCartById(payload.orderId, payload.merchantId); 

    const line_items = cart.line_items.physical_items.map(item => {
      return {
        item_id: item.id, 
        quantity: item.quantity
      };
    })

    

    const body = [
      {
        "address": {
          "first_name": name, 
          "last_name": lastName, 
          "email": payload.customerEmail, 
          "address1": address, 
          city, 
          "country_code": "RS", 
          "postal_code": postcode, 
          phone
        },
        line_items
      }
    ]

    const ship = (await instance).post(`/v3/checkouts/${payload.orderId}/consignments`, body)
    .then(async (res) => {
      return res.data.data;  
    });

    return ship;

  }

  async addBillingAddress(payload: CustomerDto, merchantId: string) {
    const instance = await this.merchantService.getInstance(merchantId);
    const { name, lastName, address, city, phone, postcode} = payload.customerAddress;
    const body = {
      "first_name": name, 
      "last_name": lastName, 
      "email": payload.customerEmail, 
      "address1": address, 
      city, 
      "country_code": "RS", 
      "postal_code": postcode, 
      phone

    }

    const bill = (await instance).post(`/v3/checkouts/${payload.orderId}/billing-address`, body)
    .then(async (res) => {
      return res.data.data;  
    });

    return bill;
  }

  async shippingOptions(payload: CustomerDto, merchantId: string){
    const instance = this.merchantService.getInstance(merchantId);

    const checkout = (await instance).get(`/v3/checkouts/${payload.orderId}?include=consignments.available_shipping_options`)
    .then(async (res) => {
      return res.data.data.consignments[0].available_shipping_options;  
    });
    return checkout;
  }

  async getCheckout(cartId: string, merchantId: string){
    const instance = this.merchantService.getInstance(merchantId);
    const checkout = (await instance).get(`/v3/checkouts/${cartId}`)
    .then((res) => {
      return res.data.data
    });

    return checkout;

  }
  
  async makeOrder(cartId: string, merchantId: string) {
    const instance = this.merchantService.getInstance(merchantId);
    const checkout = await this.getCheckout(cartId, merchantId);//uzimamo Checkout uzima ,on se radi pre prebacivanja korpe u Order
    //console.log("checkoutinorder", checkout.consignments[0].shipping_address, checkout.consignments[0].selected_shipping_option);
    const order = (await instance).post(`/v3/checkouts/${cartId}/orders`)
    .then((res) => {
      return res.data.data
    })
    .catch((error) => {
      console.log("error!!!", error);
    });
    console.log(order);
    return order;//vraća samo id od ordera
  }

  async placeOrder(payload: PlaceOrderDto, paymentMethod: string) {
    const instance = this.merchantService.getInstance(payload.merchantId);
    
    const order = await this.makeOrder(payload.orderId, payload.merchantId);
     //console.log("orderhere", order)
    if (order.errors?.length) {
      console.log('errror in Place order ', order.data.errors);
      return false;
    }
    
    let clientId = null;
    let paymentStatus = 'pending';
    let comment = 'Order placed by Köpa - Cash on delivery';
    const status = 'pending';
    if(payload.status !== 'failed')
    await this.changeStatus(order.id,payload.merchantId, 8);
  else if(payload.status == 'failed')
    await this.changeStatus(order.id,payload.merchantId, 6);

   
    if (paymentMethod !== 'cashondelivery') {
      paymentStatus = payload.status;
      clientId = payload.clientId;
      comment = `Order placed by Köpa - PreAuth transaction ${
        payload.status === 'failed' ? payload.status : 'successful'
      }`;
    
    }else if(paymentMethod === 'cashondelivery'){
      clientId = payload.clientId;
      paymentStatus = 'successful';
    }

   

    const orderInfo = {
      orderId: payload.orderId,
      paymentStatus,
      fulfilledOrderId: order.id,
      paymentMethod,
      clientId,
    };
    return orderInfo;
  }
  async changeStatus(id: number, merchantId: string, statusId: number): Promise<any> {
    console.log("inthechange", id);
    const instance = this.merchantService.getInstance(merchantId);
    const body = {
      "status_id": statusId, 
    
    }
      
    const order = (await instance).put(`/v2/orders/${id}`,body)
    .then((res) => {
      return res.data.data
    })
    .catch((error) => {
      console.log("error!!!", error);
    });
    console.log(order);
    return order;//vraća samo id od ordera
  
  }
  async completeOrder(merchantId: any, fulfilledOrderId: any) {
    const instance = await this.merchantService.getInstance(merchantId);
  
    await this.addCommentToOrder(
      merchantId,
      fulfilledOrderId,
      'PostAuth transaction successful',
      8
    );
  }
  async addCommentToOrder(merchantId: any, orderId: any, message: string, status_id: number) {
    const instance = await this.merchantService.getInstance(merchantId);
    
  }
}
