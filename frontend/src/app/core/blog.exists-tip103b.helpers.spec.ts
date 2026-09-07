import { BlogService } from './blog.service';

describe('BlogService tip103b',()=>{it('proto',()=>{expect(Object.create(BlogService.prototype)).toBeTruthy();});});
