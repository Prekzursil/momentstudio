import { BlogService } from './blog.service';

describe('BlogService tip35b',()=>{it('proto',()=>{expect(Object.create(BlogService.prototype)).toBeTruthy();});});
