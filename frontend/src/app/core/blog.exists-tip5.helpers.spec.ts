import { BlogService } from './blog.service';

describe('BlogService tip5',()=>{it('proto',()=>{expect(Object.create(BlogService.prototype)).toBeTruthy();});});
