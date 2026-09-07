import { BlogService } from './blog.service';

describe('BlogService tip8',()=>{it('proto',()=>{expect(Object.create(BlogService.prototype)).toBeTruthy();});});
