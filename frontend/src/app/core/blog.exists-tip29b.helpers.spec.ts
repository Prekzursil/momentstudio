import { BlogService } from './blog.service';

describe('BlogService tip29b',()=>{it('proto',()=>{expect(Object.create(BlogService.prototype)).toBeTruthy();});});
