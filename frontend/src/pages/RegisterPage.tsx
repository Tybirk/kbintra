import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Title,
  TextInput,
  PasswordInput,
  Button,
  Stack,
  Text,
  Anchor,
  Alert,
  Loader,
  Center,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { authApi } from '../api/auth';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [invitationEmail, setInvitationEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [formData, setFormData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    passwordConfirm: '',
  });

  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setIsValidating(false);
        setError('No invitation token provided. Please use the link from your invitation email.');
        return;
      }

      try {
        const result = await authApi.validateInvitation(token);
        setIsValid(result.valid);
        setInvitationEmail(result.email);
        setFormData((prev) => ({ ...prev, email: result.email }));
      } catch {
        setError('Invalid or expired invitation token.');
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (formData.password !== formData.passwordConfirm) {
      setError('Passwords do not match.');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsLoading(true);

    try {
      await authApi.register({
        token,
        email: formData.email,
        password: formData.password,
        password_confirm: formData.passwordConfirm,
        first_name: formData.firstName,
        last_name: formData.lastName,
      });

      notifications.show({
        title: 'Registration successful!',
        message: 'You can now log in with your credentials.',
        color: 'green',
      });

      navigate('/login');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosError = err as { response?: { data?: Record<string, string[]> } };
        const data = axiosError.response?.data;
        if (data) {
          const messages = Object.values(data).flat().join(' ');
          setError(messages);
        } else {
          setError('Registration failed. Please try again.');
        }
      } else {
        setError('Registration failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <Container size={420} my={40}>
        <Center>
          <Loader size="lg" />
        </Center>
        <Text ta="center" mt="md">
          Validating invitation...
        </Text>
      </Container>
    );
  }

  if (!isValid) {
    return (
      <Container size={420} my={40}>
        <Title ta="center" fw={900}>
          KB Intra
        </Title>

        <Paper withBorder shadow="md" p={30} mt={30} radius="md">
          <Alert color="red" title="Invalid Invitation">
            {error || 'This invitation is invalid or has expired.'}
          </Alert>

          <Text ta="center" mt="md">
            <Anchor href="/login" size="sm">
              Return to login
            </Anchor>
          </Text>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size={420} my={40}>
      <Title ta="center" fw={900}>
        Join KB Intra
      </Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        Complete your registration
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <form onSubmit={handleSubmit}>
          <Stack>
            {error && <Alert color="red">{error}</Alert>}

            <TextInput
              label="Email"
              value={invitationEmail}
              disabled
              description="Email from your invitation"
            />

            <TextInput
              label="First Name"
              placeholder="Your first name"
              required
              value={formData.firstName}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, firstName: e.currentTarget.value }))
              }
            />

            <TextInput
              label="Last Name"
              placeholder="Your last name"
              required
              value={formData.lastName}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, lastName: e.currentTarget.value }))
              }
            />

            <PasswordInput
              label="Password"
              placeholder="Create a password"
              required
              value={formData.password}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, password: e.currentTarget.value }))
              }
              description="At least 8 characters"
            />

            <PasswordInput
              label="Confirm Password"
              placeholder="Confirm your password"
              required
              value={formData.passwordConfirm}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  passwordConfirm: e.currentTarget.value,
                }))
              }
            />

            <Button type="submit" fullWidth loading={isLoading}>
              Create Account
            </Button>
          </Stack>
        </form>

        <Text c="dimmed" size="sm" ta="center" mt={15}>
          Already have an account?{' '}
          <Anchor href="/login" size="sm">
            Sign in
          </Anchor>
        </Text>
      </Paper>
    </Container>
  );
}
