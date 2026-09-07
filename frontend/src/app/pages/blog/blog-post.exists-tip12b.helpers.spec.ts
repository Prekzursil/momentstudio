import { BlogPostComponent } from './blog-post.component';

describe('BlogPostComponent tip12b',()=>{it('proto',()=>{expect(Object.create(BlogPostComponent.prototype)).toBeTruthy();});});
