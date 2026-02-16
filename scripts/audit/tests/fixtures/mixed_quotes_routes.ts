import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: "",
    title: 'routes.home.title',
    data: {
      robots: "index,follow",
    },
  },
  {
    path: 'account',
    title:
      "routes.account.title",
    children: [
      {
        path: "orders",
        title: 'routes.account.orders',
        data: {
          robots:
            'noindex,nofollow',
        },
      },
      {
        path: 'settings',
        title: getAccountTitle(),
      },
    ],
  },
  {
    path: "admin",
    children: [
      {
        path: 'content',
        children: [
          {
            path: "pages",
            title:
              "routes.admin.content.pages",
            robots: ROBOTS_NOINDEX,
          },
        ],
      },
    ],
  },
];
