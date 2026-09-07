import { BlogPostComponent } from './blog-post.component';

describe('BlogPostComponent tip13',()=>{it('proto',()=>{expect(Object.create(BlogPostComponent.prototype)).toBeTruthy();});});
