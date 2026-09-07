import { BlogService } from './blog.service';

describe('BlogService tip143b',()=>{it('proto',()=>{expect(Object.create(BlogService.prototype)).toBeTruthy();});});
