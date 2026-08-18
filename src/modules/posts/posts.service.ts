import { Injectable } from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto.js';
// import { UpdatePostDto } from './dto/update-post.dto.js';
import { PrismaService } from '../../prisma.service.js';
// import { Post, Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class PostsService {
  constructor(private prismaService: PrismaService) {}

  create(createPostDto: CreatePostDto) {
    return this.prismaService.post.create({
      data: createPostDto,
    });
  }

  findAll() {
    return this.prismaService.post.findMany();
  }

  findOne(id: number) {
    return this.prismaService.post.findUnique({ where: { id } });
  }

  /*update(id: number, updatePostDto: UpdatePostDto) {
    return `This action updates a #${id} post`;
  }
*/
  remove(id: number) {
    return `This action removes a #${id} post`;
  }
}
