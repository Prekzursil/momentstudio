import { BlogService } from './blog.service';

describe('BlogService tip21b',()=>{it('proto',()=>{expect(Object.create(BlogService.prototype)).toBeTruthy();});});
