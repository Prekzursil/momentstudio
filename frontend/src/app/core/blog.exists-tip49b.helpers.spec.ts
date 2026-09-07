import { BlogService } from './blog.service';

describe('BlogService tip49b',()=>{it('proto',()=>{expect(Object.create(BlogService.prototype)).toBeTruthy();});});
