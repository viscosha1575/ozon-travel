import './assets/css/App.css';
import { Routes, Route, Navigate } from 'react-router-dom';
import AdminLayout from './layouts/admin';
import {
  Box,
  Center,
  ChakraProvider,
  Spinner,
  Text,
} from '@chakra-ui/react';
import initialTheme from './theme/theme'; //  { themeGreen }
import { useEffect, useState } from 'react';
import { postJson, setTelegramInitData } from './api';
import { getTelegramWebApp } from './telegram';
// Chakra imports

const ADMIN_SAFE_AREA_TOP = 'var(--admin-safe-area-top, 0px)';
const ADMIN_SAFE_AREA_RIGHT = 'var(--admin-safe-area-right, 0px)';
const ADMIN_SAFE_AREA_BOTTOM = 'var(--admin-safe-area-bottom, 0px)';
const ADMIN_SAFE_AREA_LEFT = 'var(--admin-safe-area-left, 0px)';

export default function Main() {
  const [currentTheme, setCurrentTheme] = useState(initialTheme);
  const [authState, setAuthState] = useState({
    loading: true,
    error: '',
    admin: null,
  });

  useEffect(() => {
    let isMounted = true;

    async function authenticate() {
      try {
        const webApp = await getTelegramWebApp();
        setTelegramInitData(webApp.initData);

        if (webApp.isLocalBypass) {
          if (!isMounted) {
            return;
          }

          setAuthState({
            loading: false,
            error: '',
            admin: {
              id: 'local-dev',
              username: 'local_admin',
              isLocalBypass: true,
            },
          });
          return;
        }

        const response = await postJson('/api/auth/me', {});

        if (!isMounted) {
          return;
        }

        setAuthState({
          loading: false,
          error: '',
          admin: response.admin || null,
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setAuthState({
          loading: false,
          error: error.message || 'Доступ запрещен',
          admin: null,
        });
      }
    }

    void authenticate();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <ChakraProvider theme={currentTheme}>
      {authState.loading ? (
        <Center
          minH="100vh"
          flexDirection="column"
          gap="16px"
          px={`calc(24px + ${ADMIN_SAFE_AREA_LEFT} + ${ADMIN_SAFE_AREA_RIGHT})`}
          pt={`calc(24px + ${ADMIN_SAFE_AREA_TOP})`}
          pb={`calc(24px + ${ADMIN_SAFE_AREA_BOTTOM})`}
        >
          <Spinner color="brand.500" thickness="4px" size="xl" />
          <Text color="secondaryGray.700" fontSize="lg" fontWeight="600">
            Проверяем доступ к админке...
          </Text>
        </Center>
      ) : authState.error ? (
        <Center
          minH="100vh"
          px={`calc(24px + ${ADMIN_SAFE_AREA_LEFT} + ${ADMIN_SAFE_AREA_RIGHT})`}
          pt={`calc(24px + ${ADMIN_SAFE_AREA_TOP})`}
          pb={`calc(24px + ${ADMIN_SAFE_AREA_BOTTOM})`}
        >
          <Box
            bg="white"
            borderRadius="24px"
            boxShadow="0px 18px 40px rgba(112, 144, 176, 0.12)"
            maxW="560px"
            p={{ base: "24px", md: "32px" }}
            textAlign="center"
          >
            <Text color="navy.700" fontSize="2xl" fontWeight="700" mb="8px">
              Доступ к админке не получен
            </Text>
            <Text color="secondaryGray.600" fontSize="md">
              {authState.error}
            </Text>
          </Box>
        </Center>
      ) : (
        <Routes>
          <Route
            path="admin/*"
            element={
              <AdminLayout
                admin={authState.admin}
                theme={currentTheme}
                setTheme={setCurrentTheme}
              />
            }
          />
          <Route path="/" element={<Navigate to="/admin/statistics" replace />} />
        </Routes>
      )}
    </ChakraProvider>
  );
}
