import { BlogService } from './blog.service';

describe('BlogService tip1480',()=>{it('proto',()=>{expect(Object.create(BlogService.prototype)).toBeTruthy();});});
