import { BlogService } from './blog.service';

describe('BlogService tip101b',()=>{it('proto',()=>{expect(Object.create(BlogService.prototype)).toBeTruthy();});});
