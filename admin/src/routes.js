import React from 'react';

import { Icon } from '@chakra-ui/react';
import {
  MdBarChart,
  MdCampaign,
  MdCardGiftcard,
  MdEmojiEvents,
  MdLink,
  MdListAlt,
} from 'react-icons/md';

// Admin Imports
import AnalyticsPage from 'views/admin/analytics';
import ChancesPage from 'views/admin/chances';
import PlayersPage from 'views/admin/players';
import PromoCodesPage from 'views/admin/promo-codes';
import PushesPage from 'views/admin/pushes';
import UtmPage from 'views/admin/utm';

const routes = [
  {
    name: 'Статистика',
    layout: '/admin',
    path: '/statistics',
    icon: <Icon as={MdBarChart} width="20px" height="20px" color="inherit" />,
    component: <AnalyticsPage />,
  },
  {
    name: 'Призы',
    layout: '/admin',
    path: '/prizes',
    icon: <Icon as={MdCardGiftcard} width="20px" height="20px" color="inherit" />,
    component: <PromoCodesPage />,
  },
  {
    name: 'Шансы',
    layout: '/admin',
    path: '/chances',
    icon: <Icon as={MdEmojiEvents} width="20px" height="20px" color="inherit" />,
    component: <ChancesPage />,
  },
  {
    name: 'Игроки',
    layout: '/admin',
    path: '/players',
    icon: <Icon as={MdListAlt} width="20px" height="20px" color="inherit" />,
    component: <PlayersPage />,
  },
  {
    name: 'Пуши',
    layout: '/admin',
    path: '/pushes',
    icon: <Icon as={MdCampaign} width="20px" height="20px" color="inherit" />,
    component: <PushesPage />,
  },
  {
    name: 'UTM',
    layout: '/admin',
    path: '/utm',
    icon: <Icon as={MdLink} width="20px" height="20px" color="inherit" />,
    component: <UtmPage />,
  },
];

export default routes;
