import { BlogService } from './blog.service';

describe('BlogService tip1540',()=>{it('proto',()=>{expect(Object.create(BlogService.prototype)).toBeTruthy();});});
